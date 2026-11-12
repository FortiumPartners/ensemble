'use strict';

/**
 * The write-ahead veto (PR 297, kata ehsm, round 5): a recorded local gate failure must ALWAYS veto hosted acceptance.
 *
 *  W1  the gate posts `pending` BEFORE it runs (inside the lock) and a final status after; a run it cannot record never starts;
 *      a crash, a kill, a transient failure or a refused final post leaves the pending, which vetoes
 *  W2  localRunVerdict: ONE function, rules 1-7 in order, read from GitHub (newest first)
 *  W3  merge, local route: a verified payload success does not beat a newer failure / pending / unverified success on GitHub
 *  W4  merge, hosted route: the caller's own payload failure/pending is evidence too (rule G)
 *  W5  the reviewer's repros R1 (cleanup throw), R2 (refused failure post), and the earlier probes B, C, E, unpublished refusal
 *
 * In-process through `cli.main` with a stateful fake GitHub wherever that reaches the behaviour; REAL CLI processes with a
 * stateful fake `gh` (helpers/local-ci-wal-gh.js) for the crash, the 403 and the transient-then-forced cycle. No network.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const cli = require('../lib/local-ci-cli');
const { verifyRecord } = require('../lib/local-ci-record');
const { runGate: realRunGate, RUNS_DIR } = require('../lib/local-ci-runner');
const { cleanupBaseRepos, statusesApi } = require('./helpers/local-ci-base-repo');
const H = require('./helpers/local-ci-hosted');
const W = require('./helpers/local-ci-wal');

const { REPO, CONTEXT } = H;
const { status, verified, asGithub, passingRun, refusedRun, makeWorld, statusReads, walGhDir, walStates, walStatuses, setNpxMode, npxCalls, runCli, payloadFor } = W;

afterAll(() => {
  W.cleanupWalFixtures();
  cleanupBaseRepos();
});

const fx = H.hostedRepo();
const HEAD = fx.headSha;
const SHA8 = HEAD.slice(0, 8);
const OTHER = W.OTHER;

const world = (opts) => makeWorld(fx, opts);
const gate = (w, extra) => W.gate(w, fx, extra);
const merge = (w, statuses, extra) => W.merge(w, fx, statuses, extra);
const states = (w) => w.store.map((s) => s.state);
const sent = (w) => w.posts.map((p) => p.state);
const verdictCfg = { configBlobSha: W.configBlobOf(fx), approvalSet: H.APPROVAL_SET };
const verdictOf = (list, over = {}) => cli.localRunVerdict({ ghApi: statusesApi(list), ...over }, { repo: REPO, headSha: HEAD, cfg: verdictCfg });
const greenHostedRefused = (body) => expect(body).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true });

/* ------------------------------------------------------------------------------------------------ W1 */

describe('W1. the gate writes ahead: pending first, then the final status', () => {
  it('a non-dry gate posts pending (ci-local running @ sha8) inside the lock strictly before the runner, then success', async () => {
    const w = world();
    const r = await gate(w, { forceLocal: true });
    expect(r.body).toMatchObject({ ok: true, stage: 'attest', posted: true, mergeReady: true });
    expect(sent(w)).toEqual(['pending', 'success']);
    expect(w.posts[0]).toEqual({ repo: REPO, sha: HEAD, state: 'pending', context: CONTEXT, description: `ci-local running @ ${SHA8}` });
    expect(r.body.pending).toMatchObject({ published: true });
    const ev = w.events;
    expect(ev.indexOf('lock')).toBeGreaterThanOrEqual(0);
    expect(ev.indexOf('lock')).toBeLessThan(ev.indexOf('post:pending'));
    expect(ev.indexOf('post:pending')).toBeLessThan(ev.indexOf('run'));
    expect(ev.indexOf('run')).toBeLessThan(ev.indexOf('unlock'));
    expect(ev.indexOf('run')).toBeLessThan(ev.indexOf('post:success'));
    expect(ev.filter((e) => e === 'run')).toHaveLength(1);
  });

  it('a failing run posts [pending, failure]', async () => {
    const w = world();
    w.next = () => refusedRun(HEAD, { kind: 'step-failed', step: 'test', node: 22 });
    const r = await gate(w, { forceLocal: true });
    expect(r.body).toMatchObject({ ok: false, stage: 'run', posted: true });
    expect(w.posts.map((p) => [p.state, p.description])).toEqual([
      ['pending', `ci-local running @ ${SHA8}`],
      ['failure', `ci-local failed: local-ci steps / node 22 / test @ ${SHA8}`],
    ]);
    expect(states(w)).toEqual(['failure', 'pending']);
  });

  it('a dry run posts nothing at all, and still runs', async () => {
    const w = world();
    const r = await gate(w, { forceLocal: true, dryRun: true });
    expect(r.body).toMatchObject({ ok: true, dryRun: true, wouldPost: true });
    expect(w.posts).toEqual([]);
    expect(w.localRuns).toBe(1);
    const failing = world();
    failing.next = () => refusedRun(HEAD, { kind: 'step-failed', step: 'test', node: 22 });
    await gate(failing, { forceLocal: true, dryRun: true });
    expect(failing.posts).toEqual([]);
  });

  it('a lock refusal posts nothing and runs nothing', async () => {
    const w = world({ deps: { acquireGateLock: async () => ({ acquired: false, code: 'LOCK_TIMEOUT', error: 'another gate is running', queuedMs: 5 }) } });
    const r = await gate(w, { forceLocal: true });
    expect(r.body).toMatchObject({ ok: false, stage: 'lock', posted: false });
    expect(w.posts).toEqual([]);
    expect(w.localRuns).toBe(0);
  });

  it('no gate lock at all: nothing is posted and nothing runs', async () => {
    const w = world({ deps: { acquireGateLock: undefined } });
    const r = await gate(w, { forceLocal: true });
    expect(r.body).toMatchObject({ ok: false, stage: 'lock' });
    expect(w.posts).toEqual([]);
    expect(w.localRuns).toBe(0);
  });

  it('an accepted hosted shortcut posts nothing and runs nothing', async () => {
    const w = world();
    const r = await gate(w);
    expect(r.body).toMatchObject({ ok: true, stage: 'hosted', source: 'hosted' });
    expect(w.posts).toEqual([]);
    expect(w.events).toEqual([]);
  });

  describe('the pending post is the gate\'s licence to run: no record, no run', () => {
    it.each([
      ['a refused post (published:false)', { refuse: () => true }, 'HTTP 403'],
      ['a throwing postStatus', { throwOn: () => true }, 'postStatus exploded'],
      ['no postStatus at all', { deps: { postStatus: undefined } }, 'postStatus'],
    ])('%s: the runner is never called, nothing else is posted', async (_n, opts, why) => {
      const w = world(opts);
      const r = await gate(w, { forceLocal: true });
      expect(r.code).toBe(1);
      expect(r.body).toMatchObject({ ok: false, stage: 'pending', posted: false, mergeReady: false });
      expect(r.body.error.startsWith('cannot record that a local run is starting')).toBe(true);
      expect(r.body.error).toContain(why);
      expect(w.localRuns).toBe(0);
      expect(w.events).not.toContain('run');
      expect(sent(w).filter((s) => s !== 'pending')).toEqual([]);
      expect(w.posts.length).toBeLessThanOrEqual(1);
      expect(w.events).toContain('unlock'); // the lock is released even so
    });

    it('keeps the hostedRefused reason already set', async () => {
      const red = H.swap(H.honest(HEAD), H.TEST, (e) => H.withJob(e, 'test (22)', { conclusion: 'failure' }));
      const w = world({ entries: red, refuse: () => true });
      const r = await gate(w);
      expect(r.body).toMatchObject({ ok: false, stage: 'pending', posted: false });
      expect(typeof r.body.hostedRefused).toBe('string');
      expect(w.localRuns).toBe(0);
    });
  });

  describe('the final post', () => {
    it('refused: the pending remains and vetoes: merge refuses green hosted jobs, a plain gate runs locally', async () => {
      const w = world({ refuse: (req) => req.state !== 'pending' });
      const first = await gate(w, { forceLocal: true });
      expect(first.body).toMatchObject({ ok: false, mergeReady: false, posted: false, pendingRemains: true });
      expect(first.body.error).toMatch(/pending/);
      expect(states(w)).toEqual(['pending']);

      const m = await merge(w, []);
      greenHostedRefused(m.body);
      expect(m.body.localFailure).toBe(true);
      expect(m.body.source).toBeUndefined();
      expect(m.body.reason).toContain('did not finish');

      w.refuse = () => false;
      const second = await gate(w);
      expect(second.body.stage).not.toBe('hosted');
      expect(second.body.hostedRefused).toContain('did not finish');
      expect(w.localRuns).toBe(2);
      expect(second.body).toMatchObject({ ok: true, posted: true });
      expect(states(w)).toEqual(['success', 'pending', 'pending']);
    });

    it('a failing run whose failure post is refused leaves the pending: merge refuses (R2)', async () => {
      const w = world({ refuse: (req) => req.state === 'failure' });
      w.next = () => refusedRun(HEAD, { kind: 'step-failed', step: 'test', node: 22 });
      const r = await gate(w, { forceLocal: true });
      expect(r.body).toMatchObject({ ok: false, posted: false, pendingRemains: true });
      expect(states(w)).toEqual(['pending']);
      const m = await merge(w, []);
      greenHostedRefused(m.body);
      expect(m.body.localFailure).toBe(true);
    });

    it.each(['success', 'failure'])('a throwing %s post is wrapped: the gate reports it and the pending remains', async (state) => {
      const w = world({ throwOn: (req) => req.state === state });
      if (state === 'failure') w.next = () => refusedRun(HEAD, { kind: 'step-failed', step: 'test', node: 22 });
      const r = await gate(w, { forceLocal: true });
      expect(r.code).toBe(1);
      expect(r.body.error).toBeDefined();
      expect(r.body).toMatchObject({ ok: false, posted: false, pendingRemains: true });
      expect(states(w)).toEqual(['pending']);
      expect(w.events).toContain('unlock');
      greenHostedRefused((await merge(w, [])).body);
    });

    it('a success that publishes has no pendingRemains', async () => {
      const r = await gate(world(), { forceLocal: true });
      expect(r.body.pendingRemains).toBeUndefined();
    });
  });

  describe('a runner that THROWS after the pending post', () => {
    it('becomes a published head-bound runner-error failure, the lock is released, hosted is vetoed', async () => {
      const w = world();
      w.next = () => {
        throw new Error('disk on fire');
      };
      const r = await gate(w, { forceLocal: true });
      expect(r.body).toMatchObject({ ok: false, stage: 'run', posted: true, mergeReady: false });
      expect(r.body.failures).toHaveLength(1);
      expect(r.body.failures[0]).toMatchObject({ kind: 'runner-error', message: 'local CI runner threw: disk on fire' });
      expect(w.posts.map((p) => [p.state, p.description])).toEqual([
        ['pending', `ci-local running @ ${SHA8}`],
        ['failure', `ci-local refused (runner-error): clean clone @ ${SHA8}`],
      ]);
      expect(w.events).toContain('unlock');
      expect(w.events.indexOf('unlock')).toBeGreaterThan(w.events.indexOf('run'));
      expect((await merge(w, [])).body).toMatchObject({ ok: false, localFailure: true, hostedRefused: true });
    });
  });

  describe('a TRANSIENT-only failure posts nothing more: the pending stays and vetoes until a forced run passes', () => {
    it.each(['node-version', 'unfetchable-head', 'prerequisite', 'secrets', 'cleanup', 'invalid-input'])('%s', async (kind) => {
      const w = world();
      w.next = () => refusedRun(HEAD, { kind, step: 'git', node: null });
      const first = await gate(w, { forceLocal: true });
      expect(first.body).toMatchObject({ ok: false, stage: 'run', posted: false, pendingRemains: true });
      expect(sent(w)).toEqual(['pending']);
      expect(states(w)).toEqual(['pending']);

      greenHostedRefused((await merge(w, [])).body);
      const plain = await gate(w);
      expect(plain.body.stage).not.toBe('hosted');
      expect(plain.body.hostedRefused).toContain('did not finish');

      w.next = () => passingRun(HEAD);
      const forced = await gate(w, { forceLocal: true });
      expect(forced.body).toMatchObject({ ok: true, stage: 'attest', posted: true });
      expect(states(w)[0]).toBe('success');
      expect((await merge(w, [])).body).toMatchObject({ ok: true, mergeReady: true, source: 'hosted' });
      expect((await gate(w)).body).toMatchObject({ ok: true, stage: 'hosted', source: 'hosted' });
      expect((await merge(w, [{ ...w.store[0], sha: HEAD }])).body).toMatchObject({ ok: true, mergeReady: true });
    });
  });

  describe('REAL CLI processes with a stateful fake gh', () => {
    const killFx = () =>
      H.hostedRepo({
        config: H.CONFIG.replace('cmd: npm run validate', 'cmd: kill -9 $PPID'),
        files: { [H.VALIDATE]: H.WORKFLOW_FILES[H.VALIDATE].replace('npm run validate', 'kill -9 $PPID') },
      });

    it('a gate process killed mid-run (a real step runs kill -9 $PPID) leaves [pending]; a real merge then refuses green hosted jobs', () => {
      const k = killFx();
      const dir = walGhDir({ fx: k });
      const g = runCli('gate', payloadFor(k, { forceLocal: true }), dir);
      expect(g.signal).toBe('SIGKILL');
      expect(g.body).toBeNull();
      expect(walStates(dir)).toEqual(['pending']);
      expect(walStatuses(dir)[0]).toMatchObject({ context: CONTEXT, description: `ci-local running @ ${k.headSha.slice(0, 8)}`, sha: k.headSha });

      const m = runCli('merge', payloadFor(k, { statuses: [] }), dir);
      expect(m.code).toBe(1);
      expect(m.body).toMatchObject({ ok: false, mergeReady: false, hostedRefused: true, localFailure: true });
      expect(m.body.source).toBeUndefined();
      expect(m.body.reason).toContain('did not finish');
    });

    it('a pending post answered with HTTP 403: the real runner is never started and no clone is made', () => {
      const k = H.hostedRepo();
      const dir = walGhDir({ fx: k, refuse: [{ state: 'pending' }] });
      const g = runCli('gate', payloadFor(k, { forceLocal: true }), dir);
      expect(g.code).toBe(1);
      expect(g.body).toMatchObject({ ok: false, stage: 'pending', posted: false, mergeReady: false });
      expect(g.body.error.startsWith('cannot record that a local run is starting')).toBe(true);
      expect(g.body.error).toContain('403');
      expect(npxCalls(dir)).toEqual([]);
      expect(fs.existsSync(path.join(k.dir, RUNS_DIR))).toBe(false);
      expect(walStatuses(dir)).toEqual([]);
      const posts = H.ghInvocations(dir).filter((argv) => argv[1] === '-X');
      expect(posts).toHaveLength(1);
    });

    it('a transient failure (node-version) leaves [pending] and nothing else; a later forceLocal pass posts a verified success after which merge and gate accept hosted again', () => {
      const k = H.hostedRepo();
      const dir = walGhDir({ fx: k });
      setNpxMode(dir, 'fail');
      const first = runCli('gate', payloadFor(k, { forceLocal: true }), dir);
      expect(first.code).toBe(1);
      expect(first.body.failures.map((f) => f.kind)).toEqual(['node-version', 'node-version']);
      expect(first.body).toMatchObject({ ok: false, posted: false, pendingRemains: true });
      expect(npxCalls(dir).length).toBeGreaterThan(0);
      expect(walStates(dir)).toEqual(['pending']);
      const refused = runCli('merge', payloadFor(k, { statuses: [] }), dir);
      expect(refused.body).toMatchObject({ ok: false, hostedRefused: true, localFailure: true });
      const plain = runCli('gate', payloadFor(k), dir);
      expect(plain.body.hostedRefused).toContain('did not finish');

      setNpxMode(dir, 'ok');
      const pass = runCli('gate', payloadFor(k, { forceLocal: true }), dir);
      expect(pass.body).toMatchObject({ ok: true, stage: 'attest', posted: true, mergeReady: true });
      expect(walStates(dir).slice(0, 2)).toEqual(['success', 'pending']);
      const success = walStatuses(dir)[0];
      expect(verifyRecord({ description: success.description, statusCommitSha: k.headSha, headSha: k.headSha, workflowSet: W.WORKFLOW_SET, runnerBlobSha: W.configBlobOf(k) }).ok).toBe(true);

      const hosted = runCli('merge', payloadFor(k, { statuses: [] }), dir);
      expect(hosted.body).toMatchObject({ ok: true, mergeReady: true, source: 'hosted' });
      expect(runCli('gate', payloadFor(k), dir).body).toMatchObject({ ok: true, stage: 'hosted', source: 'hosted' });
      const local = runCli('merge', payloadFor(k, { statuses: [{ context: CONTEXT, state: 'success', description: success.description, sha: k.headSha }] }), dir);
      expect(local.body).toMatchObject({ ok: true, mergeReady: true });
      expect(local.body.source).toBeUndefined();
    });
  });
});

/* ------------------------------------------------------------------------------------------------ W2 */

describe('W2. localRunVerdict: rules 1-7, in order', () => {
  it('is exported and is the one function merge and gate use', () => {
    expect(typeof cli.localRunVerdict).toBe('function');
    expect(cli.recordedLocalFailure).toBeUndefined();
  });

  describe('rule 1: an unreadable list vetoes (not recorded)', () => {
    it.each([
      ['no ghApi at all', { ghApi: undefined }],
      ['a failed lookup', { ghApi: () => ({ ok: false, error: 'gh api failed: HTTP 502' }) }],
      ['no answer', { ghApi: () => undefined }],
      ['an answer without json', { ghApi: () => ({ ok: true }) }],
      ['json that is not a list', { ghApi: () => ({ ok: true, json: { state: 'success' } }) }],
      ['json null', { ghApi: () => ({ ok: true, json: null }) }],
    ])('%s', (_n, deps) => {
      const v = cli.localRunVerdict(deps, { repo: REPO, headSha: HEAD, cfg: verdictCfg });
      expect(v).toMatchObject({ kind: 'veto', recorded: false });
      expect(v.reason).toContain(`cannot read the commit statuses of ${HEAD}`);
    });

    it.each([
      ['an Error', () => { throw new Error('spawn gh ENOENT'); }],
      ['a thrown string', () => { throw 'boom'; }],
    ])('a lookup that THROWS (%s) is an unreadable list, not a crash: veto, not recorded, with the reason', (_n, ghApi) => {
      const v = cli.localRunVerdict({ ghApi }, { repo: REPO, headSha: HEAD, cfg: verdictCfg });
      expect(v).toMatchObject({ kind: 'veto', recorded: false });
      expect(v.reason).toContain(`cannot read the commit statuses of ${HEAD}`);
    });

    it('asks for exactly the head\'s first full page', () => {
      const api = statusesApi([]);
      expect(api.calls).toEqual([]);
      cli.localRunVerdict({ ghApi: api }, { repo: REPO, headSha: HEAD, cfg: verdictCfg });
      expect(api.calls).toEqual([`repos/${REPO}/commits/${HEAD}/statuses?per_page=100`]);
    });
  });

  describe('rule 2: an entry that is not what GitHub documents vetoes (not recorded)', () => {
    it.each([
      ['null', null],
      ['a number', 5],
      ['a string', 'success'],
      ['a list', []],
      ['an object without a context', { state: 'success', id: 1 }],
      ['an object with a context that is not text', { context: 7, state: 'success', id: 1 }],
    ])('%s, even after a verified success', (_n, entry) => {
      const v = verdictOf([{ id: 9, context: CONTEXT, state: 'success', description: W.verifiedDescription(fx) }, entry]);
      expect(v).toMatchObject({ kind: 'veto', recorded: false });
    });
  });

  describe('rule 3: the context compare is case-insensitive; the list must be newest first', () => {
    it('a failure in other letters is the same context', () => {
      expect(verdictOf([{ id: 2, context: CONTEXT.toUpperCase(), state: 'failure' }])).toMatchObject({ kind: 'veto', recorded: true });
      expect(verdictOf([{ id: 2, context: CONTEXT.toUpperCase(), state: 'success', description: W.verifiedDescription(fx) }])).toMatchObject({ kind: 'verified' });
    });

    it('an older entry with a LARGER id than the latest means the list is not newest first: veto, not recorded', () => {
      const v = verdictOf([
        { id: 1, context: CONTEXT, state: 'success', description: W.verifiedDescription(fx) },
        { id: 2, context: CONTEXT, state: 'failure', description: 'x' },
      ]);
      expect(v).toMatchObject({ kind: 'veto', recorded: false });
    });

    it('the same list in the right order is decided by its latest', () => {
      const list = [
        { id: 2, context: CONTEXT, state: 'success', description: W.verifiedDescription(fx) },
        { id: 1, context: CONTEXT, state: 'failure', description: 'x' },
      ];
      expect(verdictOf(list)).toMatchObject({ kind: 'verified' });
    });

    it('the sanity check needs an integer id on EVERY entry of the context; other contexts\' ids do not count', () => {
      const ok = { context: CONTEXT, state: 'success', description: W.verifiedDescription(fx) };
      expect(verdictOf([{ ...ok, id: 1 }, { context: CONTEXT, state: 'failure' }])).toMatchObject({ kind: 'verified' });
      expect(verdictOf([{ ...ok, id: 1 }, { context: CONTEXT, state: 'failure', id: '9' }])).toMatchObject({ kind: 'verified' });
      expect(verdictOf([{ ...ok, id: 1 }, { context: 'ci/other', state: 'failure', id: 99 }])).toMatchObject({ kind: 'verified' });
    });
  });

  describe('rule 4: no entry in the context', () => {
    const other = (n) => Array.from({ length: n }, (_, i) => ({ id: 3000 - i, context: 'ci/other', state: 'success', description: 'x' }));
    it('a short list is "none": nothing local ever ran', () => {
      expect(verdictOf([])).toEqual({ kind: 'none' });
      expect(verdictOf(other(99))).toEqual({ kind: 'none' });
    });
    it('a FULL page (100) without the context vetoes, not recorded: the context may lie beyond it', () => {
      expect(verdictOf(other(100))).toMatchObject({ kind: 'veto', recorded: false });
      expect(verdictOf(other(101))).toMatchObject({ kind: 'veto', recorded: false });
    });
    it('a full page that holds the context is decided by it', () => {
      const ours = { id: 1, context: CONTEXT, state: 'success', description: W.verifiedDescription(fx) };
      expect(verdictOf([...other(99), ours])).toMatchObject({ kind: 'verified' });
      expect(verdictOf([...other(99), { ...ours, state: 'failure' }])).toMatchObject({ kind: 'veto', recorded: true });
    });
    it('other contexts are ignored, whatever they say', () => {
      expect(verdictOf([{ id: 3, context: 'ci/other', state: 'failure' }, { id: 2, context: 'ci/x', state: 'pending' }])).toEqual({ kind: 'none' });
    });
  });

  describe('rule 5: the latest is a success', () => {
    it('whose record verifies -> verified (with the status)', () => {
      const entry = { id: 4, context: CONTEXT, state: 'success', description: W.verifiedDescription(fx) };
      expect(verdictOf([entry])).toEqual({ kind: 'verified', status: entry });
    });

    it.each([
      ['an empty description', ''],
      ['a description that is not text', 42],
      ['no description', undefined],
      ['a malformed description', 'ci-local nonsense'],
      ['a record for another config blob', W.verifiedDescription(fx, { blob: 'a'.repeat(40) })],
      ['a record for another workflow set', W.verifiedDescription(fx, { set: ['.github/workflows/other.yml'] })],
      ['a record for a subset of the workflow set', W.verifiedDescription(fx, { set: [H.VALIDATE] })],
    ])('%s is a success that does NOT verify: it vetoes (recorded) and clears nothing', (_n, description) => {
      const list = [{ id: 5, context: CONTEXT, state: 'success', ...(description === undefined ? {} : { description }) }, { id: 4, context: CONTEXT, state: 'failure', description: 'x' }];
      const v = verdictOf(list);
      expect(v).toMatchObject({ kind: 'veto', recorded: true });
      expect(v.reason).toContain('whose record does not verify');
      expect(v.reason).toContain(CONTEXT);
      expect(v.reason).toContain(HEAD);
    });

    it('a verified success clears an older failure and an older pending', () => {
      const good = { id: 9, context: CONTEXT, state: 'success', description: W.verifiedDescription(fx) };
      expect(verdictOf([good, { id: 8, context: CONTEXT, state: 'pending', description: 'x' }, { id: 7, context: CONTEXT, state: 'failure', description: 'x' }])).toMatchObject({ kind: 'verified' });
    });
  });

  it('rule 6: a pending latest vetoes (recorded), over an older verified success', () => {
    const v = verdictOf([
      { id: 9, context: CONTEXT, state: 'pending', description: 'x' },
      { id: 8, context: CONTEXT, state: 'success', description: W.verifiedDescription(fx) },
    ]);
    expect(v).toMatchObject({ kind: 'veto', recorded: true });
    expect(v.reason).toContain('did not finish');
    expect(v.reason).toContain('pending');
  });

  describe('rule 7: everything else vetoes (recorded)', () => {
    it.each([['failure'], ['error'], ['weird'], [5], [''], [undefined], [null]])('state %p', (state) => {
      const v = verdictOf([{ id: 9, context: CONTEXT, ...(state === undefined ? {} : { state }), description: 'x' }, { id: 8, context: CONTEXT, state: 'success', description: W.verifiedDescription(fx) }]);
      expect(v).toMatchObject({ kind: 'veto', recorded: true });
      expect(v.reason).toContain('green hosted jobs do not override it');
      if (typeof state === 'string' && state !== '') expect(v.reason).toContain(`recorded ${state} for ${CONTEXT}`);
    });
  });

  it('reasons carry no advice text (merge adds it)', () => {
    for (const list of [[{ id: 1, context: CONTEXT, state: 'failure' }], [{ id: 1, context: CONTEXT, state: 'pending' }], [{ id: 1, context: CONTEXT, state: 'success', description: '' }]]) {
      expect(verdictOf(list).reason).not.toMatch(/forceLocal/);
    }
  });

  describe('through merge and gate', () => {
    it.each([
      ['pending latest', [{ id: 9, context: CONTEXT, state: 'pending', description: 'x' }], false],
      ['pending over an old verified success', [{ id: 9, context: CONTEXT, state: 'pending', description: 'x' }, { id: 8, context: CONTEXT, state: 'success', description: W.verifiedDescription(fx) }], false],
      ['failure over a verified success', [{ id: 9, context: CONTEXT, state: 'failure', description: 'x' }, { id: 8, context: CONTEXT, state: 'success', description: W.verifiedDescription(fx) }], false],
      ['an UNVERIFIED success over a failure', [{ id: 9, context: CONTEXT, state: 'success', description: 'x' }, { id: 8, context: CONTEXT, state: 'failure', description: 'x' }], false],
      ['a verified success over a failure and a pending', [{ id: 9, context: CONTEXT, state: 'success', description: W.verifiedDescription(fx) }, { id: 8, context: CONTEXT, state: 'pending', description: 'x' }, { id: 7, context: CONTEXT, state: 'failure', description: 'x' }], true],
      ['no status in the context', [{ id: 9, context: 'ci/other', state: 'failure' }], true],
      ['the context in other letters', [{ id: 9, context: CONTEXT.toUpperCase(), state: 'pending' }], false],
    ])('%s: merge and gate agree (accepted: %p)', async (_n, initial, accepted) => {
      const wm = world({ initial });
      const m = await merge(wm, []);
      expect(m.body.ok).toBe(accepted);
      if (accepted) expect(m.body.source).toBe('hosted');
      else expect(m.body).toMatchObject({ hostedRefused: true, localFailure: true });
      if (!accepted) expect(m.body.reason).toMatch(/; re-run the gate with forceLocal:true$/);

      const wg = world({ initial });
      const g = await gate(wg);
      expect(g.body.stage === 'hosted').toBe(accepted);
      expect(wg.localRuns).toBe(accepted ? 0 : 1);
      if (!accepted) expect(g.body.hostedRefused).toMatch(/^hosted CI not accepted: /);
    });

    it.each([
      ['unreadable', { answer: (p, proceed) => (/\/statuses\?/.test(p) ? { ok: false, error: 'gh api failed: HTTP 502' } : proceed()) }],
      ['not a list', { answer: (p, proceed) => (/\/statuses\?/.test(p) ? { ok: true, json: { state: 'success' } } : proceed()) }],
    ])('statuses %s: refused, not a recorded failure', async (_n, api) => {
      const m = await merge(world({ api }), []);
      greenHostedRefused(m.body);
      expect(m.body.localFailure).toBeUndefined();
      expect(m.body.reason).toContain('cannot read the commit statuses');
      const wg = world({ api });
      expect((await gate(wg)).body.stage).not.toBe('hosted');
      expect(wg.localRuns).toBe(1);
    });

    it('exactly one statuses read per merge, in both routes', async () => {
      const hosted = world();
      expect((await merge(hosted, [])).body.source).toBe('hosted');
      expect(statusReads(hosted)).toBe(1);
      expect(hosted.ghApi.calls[hosted.ghApi.calls.length - 1]).toBe(`repos/${REPO}/commits/${HEAD}/statuses?per_page=100`);

      const local = world({ initial: asGithub([verified(fx)]) });
      expect((await merge(local, [verified(fx)])).body).toMatchObject({ ok: true, mergeReady: true });
      expect(statusReads(local)).toBe(1);

      const refusedLocal = world({ initial: asGithub([status('failure'), verified(fx)]) });
      await merge(refusedLocal, [verified(fx)]);
      expect(statusReads(refusedLocal)).toBe(1);
    });
  });
});

/* ------------------------------------------------------------------------------------------------ W3 */

describe('W3. merge, local route: GitHub\'s newest status beats an older verified success in the payload', () => {
  const ok = () => verified(fx);

  it.each([
    ['a newer failure', [status('failure'), ok()]],
    ['a newer error', [status('error'), ok()]],
    ['a newer pending', [status('pending'), ok()]],
    ['a newer UNVERIFIED success', [status('success', { description: 'x' }), ok()]],
    ['a newer success with another config blob', [status('success', { description: W.verifiedDescription(fx, { blob: 'b'.repeat(40) }) }), ok()]],
    ['a newer failure in other letters', [status('failure', { context: CONTEXT.toUpperCase() }), ok()]],
  ])('%s is refused (localFailure), not hosted-refused', async (_n, onGithub) => {
    const w = world({ initial: asGithub(onGithub) });
    const m = await merge(w, [ok()]);
    expect(m.code).toBe(1);
    expect(m.body).toMatchObject({ ok: false, mergeReady: false, headSha: HEAD, localFailure: true });
    expect(m.body.hostedRefused).toBeUndefined();
    expect(m.body.source).toBeUndefined();
    expect(m.body.reason).toMatch(/; re-run the gate with forceLocal:true$/);
    expect(w.prInfo.calls).toHaveLength(1);
  });

  it('S1: GitHub newest-first [failure, older verified success] with the verified success in the payload is refused', async () => {
    const w = world({ initial: asGithub([status('failure'), ok()]) });
    const m = await merge(w, [ok()]);
    expect(m.body).toMatchObject({ ok: false, localFailure: true });
    expect(m.body.reason).toContain(`recorded failure for ${CONTEXT} on ${HEAD}`);
  });

  it('GitHub\'s latest being that verified success, or GitHub listing nothing in the context, accepts (pinned: the payload stays trusted then)', async () => {
    for (const initial of [asGithub([ok()]), [], asGithub([status('failure', { context: 'ci/other' })]), asGithub([ok(), status('failure')])]) {
      const w = world({ initial });
      const m = await merge(w, [ok()]);
      expect(m.body).toMatchObject({ ok: true, mergeReady: true, hostedCiWaitRequired: false });
      expect(m.body.source).toBeUndefined();
    }
  });

  it.each([
    ['the lookup fails', { answer: (p, proceed) => (/\/statuses\?/.test(p) ? { ok: false, error: 'gh api failed: HTTP 502' } : proceed()) }],
    ['the answer is not a list', { answer: (p, proceed) => (/\/statuses\?/.test(p) ? { ok: true, json: {} } : proceed()) }],
  ])('GitHub unreadable (%s): refused, not a recorded failure', async (_n, api) => {
    const m = await merge(world({ api }), [ok()]);
    expect(m.body).toMatchObject({ ok: false, mergeReady: false });
    expect(m.body.localFailure).toBe(false); // judged unreadable, nothing recorded
    expect(m.body.reason).toContain('cannot read the commit statuses');
  });

  it('no ghApi at all: refused', async () => {
    const m = await merge(world({ deps: { ghApi: undefined } }), [ok()]);
    expect(m.body).toMatchObject({ ok: false, mergeReady: false });
    expect(m.body.reason).toContain('no GitHub lookup');
  });

  it('the same without any hosted opt-in in the config: the local route still reads GitHub', async () => {
    const plain = H.hostedRepo({ config: H.CONFIG_WITHOUT_HOSTED });
    const okPlain = verified(plain);
    const refused = makeWorld(plain, { initial: asGithub([status('failure'), okPlain]) });
    expect((await W.merge(refused, plain, [okPlain])).body).toMatchObject({ ok: false, localFailure: true });
    const fine = makeWorld(plain, { initial: asGithub([okPlain]) });
    expect((await W.merge(fine, plain, [okPlain])).body).toMatchObject({ ok: true, mergeReady: true });
  });
});

/* ------------------------------------------------------------------------------------------------ W4 */

describe('W4. merge, hosted route: the caller\'s own payload counts against the head (rule G)', () => {
  const cases = [
    ['a failure', 'failure'],
    ['an error', 'error'],
    ['a pending', 'pending'],
    ['an unknown state', 'weird'],
    ['a state that is not text', 5],
  ];

  it.each(cases)('%s on the head in the payload with GitHub silent vetoes', async (_n, state) => {
    const w = world();
    const m = await merge(w, [status(state, { sha: HEAD })]);
    greenHostedRefused(m.body);
    expect(m.body.localFailure).toBe(true);
    expect(m.body.source).toBeUndefined();
    expect(w.prInfo.calls).toHaveLength(1);
  });

  it.each(cases)('%s on ANOTHER full commit does not veto', async (_n, state) => {
    expect((await merge(world(), [status(state, { sha: OTHER })])).body).toMatchObject({ ok: true, source: 'hosted' });
  });

  it.each([
    ['no sha', undefined],
    ['a malformed sha', 'abc123'],
    ['a sha that is not text', 42],
    ['an empty sha', ''],
  ])('with %s it cannot be attributed to another commit: it vetoes even when GitHub shows a verified success', async (_n, sha) => {
    const bad = status('failure', { ...(sha === undefined ? {} : { sha }) });
    const silent = await merge(world(), [bad]);
    greenHostedRefused(silent.body);
    expect(silent.body.localFailure).toBe(true);
    expect(silent.body.reason).toContain('carries no usable commit SHA');
    const shown = await merge(world({ initial: asGithub([verified(fx)]) }), [bad]);
    greenHostedRefused(shown.body);
  });

  it('GitHub showing a NEWER verified success with a payload failure on the head: the success is newer evidence, no veto', async () => {
    const w = world({ initial: asGithub([verified(fx), status('failure')]) });
    const m = await merge(w, [status('failure', { sha: HEAD })]);
    expect(m.body).toMatchObject({ ok: true, mergeReady: true, source: 'hosted' });
  });

  it('a payload failure on the head with GitHub pending/failure vetoes by GitHub\'s verdict too', async () => {
    const m = await merge(world({ initial: asGithub([status('pending')]) }), [status('failure', { sha: HEAD })]);
    greenHostedRefused(m.body);
  });

  it('a payload failure in another context never vetoes', async () => {
    expect((await merge(world(), [status('failure', { context: 'ci/other', sha: HEAD })])).body).toMatchObject({ ok: true, source: 'hosted' });
  });

  it('a payload failure in other letters of the context is the context', async () => {
    greenHostedRefused((await merge(world(), [status('failure', { context: CONTEXT.toUpperCase(), sha: HEAD })])).body);
  });
});

/* ------------------------------------------------------------------------------------------------ W5 */

describe('W5. the reviewer\'s repros and the earlier probes', () => {
  it('R1: a failing step leaves unreadable directories; the REAL runner does not throw, the failure is posted, the clone is gone', async () => {
    const k = H.hostedRepo();
    const w = makeWorld(k);
    const runs = path.join(k.dir, RUNS_DIR);
    w.deps.runnerDeps = {
      resolveNodeBinDir: (major) => `/fake/node${major}/bin`,
      run: (cmd, o) => {
        if (cmd === 'node --version') return { status: 0, stdout: `v${/node(\d+)/.exec(o.env.PATH)[1]}.0.0\n`, stderr: '' };
        if (cmd === 'npm run validate') {
          spawnSync('bash', ['-c', 'mkdir -p x/y && touch x/y/f && chmod 000 x/y x'], { cwd: o.cwd });
          return { status: 1, stdout: '', stderr: 'boom' };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    };
    w.deps.runGate = (options, injected) => {
      w.events.push('run');
      w.localRuns += 1;
      return realRunGate(options, injected);
    };
    try {
      const r = await W.gate(w, k, { forceLocal: true });
      expect(r.body.error).not.toMatch(/ENOTEMPTY|EACCES|EPERM/);
      expect(r.body).toMatchObject({ ok: false, stage: 'run', posted: true, mergeReady: false });
      expect(w.posts.map((p) => p.state)).toEqual(['pending', 'failure']);
      expect(r.body.failures.some((f) => f.kind === 'step-failed')).toBe(true);
      expect(fs.existsSync(path.join(runs, k.headSha))).toBe(false);
      greenHostedRefused((await W.merge(w, k, [])).body);
    } finally {
      spawnSync('chmod', ['-R', 'u+rwx', runs]);
    }
  });

  it('R2: the failure POST is refused (403): the pending remains and merge with green hosted jobs is refused', async () => {
    const w = world({ refuse: (req) => req.state === 'failure' });
    w.next = () => refusedRun(HEAD, { kind: 'clone-tampered', step: 'test', node: 22 });
    const g = await gate(w, { forceLocal: true });
    expect(g.body).toMatchObject({ ok: false, posted: false, pendingRemains: true });
    expect(states(w)).toEqual(['pending']);
    const m = await merge(w, []);
    greenHostedRefused(m.body);
    expect(m.body.localFailure).toBe(true);
  });

  it('probe B: GitHub holds a failure, the payload omits it: refused with localFailure, through the gate too', async () => {
    const w = world({ initial: asGithub([status('failure')]) });
    expect((await merge(w, [])).body).toMatchObject({ ok: false, hostedRefused: true, localFailure: true });
    const g = world({ initial: asGithub([status('failure')]) });
    expect((await gate(g)).body.stage).not.toBe('hosted');
    expect(g.localRuns).toBe(1);
  });

  it('probe C: a failure with no sha vetoes; C2: with the head sha and GitHub silent it vetoes too (fail closed)', async () => {
    greenHostedRefused((await merge(world(), [status('failure')])).body);
    greenHostedRefused((await merge(world(), [status('failure', { sha: HEAD })])).body);
  });

  it('probe E: a newer failed run with a malformed id beside an older green one is refused', async () => {
    const bad = H.hostedRun(999, H.TEST, ['test (22)', 'test (24)'], HEAD, { run: { id: '999', conclusion: 'failure' }, job: { conclusion: 'failure' } });
    const m = await merge(world({ entries: [...H.honest(HEAD), bad] }), []);
    greenHostedRefused(m.body);
    expect(m.body.reason).toContain('malformed id');
  });

  it('unpublished-refusal probe: a clone-tampered refusal is published (with the pending before it), merge refuses, a plain gate runs locally', async () => {
    const w = world();
    w.next = () => refusedRun(HEAD, { kind: 'clone-tampered', step: 'test', node: 22 });
    const g = await gate(w, { forceLocal: true });
    expect(g.body).toMatchObject({ ok: false, posted: true });
    expect(w.posts.map((p) => [p.state, p.description])).toEqual([
      ['pending', `ci-local running @ ${SHA8}`],
      ['failure', `ci-local refused (clone-tampered): node 22 / test @ ${SHA8}`],
    ]);
    expect((await merge(w, [])).body).toMatchObject({ ok: false, localFailure: true, hostedRefused: true });
    const again = await gate(w);
    expect(again.body.stage).toBe('run');
    expect(again.body.hostedRefused).toContain('recorded failure');
    expect(w.localRuns).toBe(2);
  });

  it('the fixtures are honest: hosted CI is green on the head and nothing is posted, so hosted stands in (control)', async () => {
    const w = world();
    expect((await merge(w, [])).body).toMatchObject({ ok: true, source: 'hosted' });
    expect(w.posts).toEqual([]);
  });
});
